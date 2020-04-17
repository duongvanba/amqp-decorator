import { Message } from "amqplib-as-promised/lib"
import { waitFor } from "./waitFor"
import { WAITFOR } from "./symbol"
import { AMQP } from "./AMQP"
import { v4 } from 'uuid'

const AMQP_RESPONDER_QUEUES = Symbol.for('AMQP_RESPONDER_QUEUES')

const Callbacks = new Map<string, { reject: Function, success: Function }>()

type AMQPQueueOption = {
    process_old_requests?: boolean,
    limit?: number,
    id?: string | ((s: any) => Promise<string> | string),
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
            if (!process_old_requests && request.requested_time < started_time) return limit && await channel.ack(msg)
            try {
                const result = await target[method](...request.args) || {}
                if (typeof result == 'object' && result[WAITFOR]) { // If have looong task
                    const { [WAITFOR]: wait_long_task, ...data } = result
                    const response: Response = { id: request.id, success: true, data }
                    channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)))
                    await wait_long_task()
                } else {
                    const response: Response = { id: request.id, success: true, data: result }
                    AMQP.channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)))
                }
            } catch (e) {
                const message = typeof e == 'string' ? e : e.message
                const response: Response = { id: request.id, success: false, message }
                channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)))

            }
            limit && await channel.ack(msg)
        }

        // Round request
        await channel.assertQueue(queue, { durable: false })
        channel.consume(
            queue,
            message_handler,
            { noAck: limit == undefined, consumerTag: `${request_name}-${method}-responder-${v4()}` }
        )

        // Create direct request
        if (id) {
            const key = typeof id == 'string' ? id : await id(target)
            await channel.assertExchange(queue, 'direct')
            const { queue: direct_request_queue } = await channel.assertQueue(`${queue}--${key}`, { exclusive: true, durable: false })
            await channel.bindQueue(direct_request_queue, queue, key)
            await channel.consume(
                direct_request_queue,
                message_handler,
                { noAck: limit == undefined, consumerTag: `${request_name}-${method}-responder-${v4()}` }
            )
        }

    })

    await Promise.all(promises)


}




export const AmqpRemoteService = async <T>(target: any, omit_events: string[] = []) => {

    if (!AMQP.channel) throw new Error('Init amqp connection before tasks')
    const name = Object.getPrototypeOf(target).name
    const { queue: respond_to } = await AMQP.channel.assertQueue('', { exclusive: true, durable: false })

    await AMQP.channel.consume(respond_to, async msg => {
        const { id, success, data, message } = JSON.parse(msg.content) as Response
        if (Callbacks.has(id)) {
            const cb = Callbacks.get(id)
            success ? cb.success(data) : cb.reject(message)
            Callbacks.delete(id)
        }
    }, { noAck: true })


    return new Proxy(target, {
        get: (_, prop) => {

            if ([...omit_events, 'then'].includes(prop as string)) return null

            if (prop == 'to') return key => new Proxy({}, {
                get: (_, prop) => async (...args: any[]) => {
                    const method = prop as string
                    const id = v4()
                    const data = Buffer.from(JSON.stringify({ args, id, respond_to } as Request))
                    return await new Promise(async (success, reject) => {
                        Callbacks.set(id, { success, reject })
                        await AMQP.channel.publish(`${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`, key, data)
                    })
                }
            })

            return async (...args: any[]) => {
                const method = prop as string
                const id = v4()
                const data = { args, id, respond_to, requested_time: Date.now() } as Request
                return await new Promise(async (success, reject) => {
                    Callbacks.set(id, { success, reject })
                    await AMQP.channel.sendToQueue(
                        `${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`,
                        Buffer.from(JSON.stringify(data))
                    )
                })
            }
        }
    }) as (T & { to: (key: string) => T })

}

export type AmqpRemoteService<T> = T & { to: (key: string) => T }