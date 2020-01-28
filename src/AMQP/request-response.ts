import { Message } from "amqplib-as-promised/lib"
import { waitFor } from "./waitFor"
import { WAITFOR, AMQP_DECORATER_INITED } from "./symbol"
import { AMQP } from "./AMQP"
import { v4 } from 'uuid'

const AMQP_RESPONDER_QUEUES = Symbol.for('AMQP_RESPONDER_QUEUES')

const Callbacks = new Map<string, { reject: Function, success: Function }>()

type AMQPQueueOption = {
    process_old_requests?: boolean,
    limit?: number,
    id?: string | Promise<string>,
    active_when?: (target: any) => boolean | Promise<boolean>
}

type QueueDecoratorMetadata = AMQPQueueOption & { method: string }

type Request = { id: string, args: any[], respond_to: string, requested_time: number }
type Response = { success: boolean, data?: any, message?: string, id: string }


export const AmqpResponder = (options: AMQPQueueOption = {}) => (
    target: any,
    method: string
) => {
    const list: QueueDecoratorMetadata[] = Reflect.getMetadata(AMQP_RESPONDER_QUEUES, target) || []
    list.push({ method, process_old_requests: false, ...options })
    Reflect.defineMetadata(AMQP_RESPONDER_QUEUES, list, target)
}

export const getKey = async(key: any) => {
    if(typeof key == 'function') return await key()
    return await key
}


export const activeResponders = async (target: any) => {

    const request_name = Object.getPrototypeOf(Object.getPrototypeOf(target)).constructor.name
    const responders = (Reflect.getMetadata(AMQP_RESPONDER_QUEUES, target) || []) as QueueDecoratorMetadata[]

    const promises = responders.map(async ({ method, active_when, limit, id, process_old_requests }) => {

        active_when && await waitFor(() => active_when(target))
        const started_time = Date.now()

        const channel = await AMQP.getChannel({ limit })
        const queue = `${process.env.QUEUE_PREFIX || ''}|amqp|request::${request_name}-${method}` // Listen requests queue & exchange



        const message_handler = async (msg: Message) => {
            const request = JSON.parse(msg.content.toString()) as Request
            if (!process_old_requests && request.requested_time < started_time) return await channel.ack(msg)
            try {
                const result = await target[method](...request.args) || {}
                if (typeof result == 'object' && result[WAITFOR]) { // If have looong task
                    const { [WAITFOR]: wait_long_task, ...data } = result
                    const response: Response = { id: request.id, success: true, data }
                    channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)))
                    await wait_long_task()
                } else {
                    const response: Response = { id: request.id, success: true, data: result }
                    AMQP.publish_channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)))
                }
            } catch (e) {
                const message = typeof e == 'string' ? e : e.message
                const response: Response = { id: request.id, success: false, message }
                channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)))

            }
            await channel.ack(msg)
        }

        // Round request
        await channel.assertQueue(queue, { durable: false })
        channel.consume(
            queue,
            message_handler,
            { noAck: false, consumerTag: `${request_name}-${method}-responder-${v4()}` }
        )

        // Create direct request
        if (id) {
            const key = await getKey(id)
            await channel.assertExchange(queue, 'direct')
            const { queue: direct_request_queue } = await channel.assertQueue('', { exclusive: true })
            await channel.bindQueue(direct_request_queue, queue, key)
            await channel.consume(
                direct_request_queue,
                message_handler,
                { noAck: false, consumerTag: `${request_name}-${method}-responder-${v4()}` }
            )
        }

    })

    await Promise.all(promises)


}




export const AmqpRemoteService = async <T>(target: any) => {
    if (!AMQP.publish_channel) throw new Error('Init amqp connection before tasks')
    const inited = Reflect.getMetadata(AMQP_DECORATER_INITED, target)
    const client_class = target.prototype
    const name = client_class.constructor.name
    if (!inited) throw new Error('MISSING AMQP INIT DECORATOR for ' + name)
    const responders: QueueDecoratorMetadata[] = Reflect.getMetadata(AMQP_RESPONDER_QUEUES, client_class) || []

    const respond_to_queues = new Map<string, string>()

    const promises = responders.map(async r => {
        try {
            const queue = `${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${r.method}`
            await AMQP.publish_channel.assertQueue(queue, { durable: false })
            const { queue: respond_to_queue } = await AMQP.publish_channel.assertQueue(`${queue}|${v4()}`, { durable: false })
            respond_to_queues.set(r.method, respond_to_queue)
            await AMQP.consume_channel.consume(
                respond_to_queue,
                async msg => {
                    const { id, data, success, message } = JSON.parse(msg.content.toString()) as Response
                    if (Callbacks.has(id)) {
                        success ? Callbacks.get(id).success(data) : Callbacks.get(id).reject(message)
                        Callbacks.delete(id)
                    }
                },
                { noAck: true }
            )
        } catch (e) {
            console.log('Error here', e)
        }
    })
    await Promise.all(promises)



    return new Proxy(target, {
        get: (_, prop) => {

            if (prop == 'to') return key => new Proxy({}, {
                get: (_, prop) => async (...args: any[]) => {
                    const method = prop as string
                    if (!respond_to_queues.has(method)) throw new Error(`Missing decorator for method ${name}.${method} *`)
                    const id = v4()
                    const data = Buffer.from(JSON.stringify({ args, id, respond_to: respond_to_queues.get(method) } as Request))
                    return await new Promise(async (success, reject) => {
                        Callbacks.set(id, { success, reject })
                        await AMQP.publish_channel.publish(`${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`, key, data)
                    })
                }
            })

            if (!respond_to_queues.has(prop as string)) return undefined

            return async (...args: any[]) => {
                const method = prop as string
                const id = v4()
                const data = Buffer.from(JSON.stringify({ args, id, respond_to: respond_to_queues.get(method), requested_time: Date.now() } as Request))
                return await new Promise(async (success, reject) => {
                    Callbacks.set(id, { success, reject })
                    await AMQP.publish_channel.sendToQueue(`${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`, data)
                })
            }
        }
    }) as (T & { to: (key: string) => T })

}

export type AmqpRemoteService<T> = T & { to: (key: string) => T }