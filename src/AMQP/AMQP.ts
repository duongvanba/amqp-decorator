import 'reflect-metadata'
import { Connection, Channel } from "amqplib-as-promised/lib"
import { activeResponders } from './request-response'
import { activeSubscribers } from './pub-sub'
import { v4 } from 'uuid'
import { ON_READY_CALLBACK, ON_RECONNECT_CALLBACK } from './symbol'

const ResponseCallbackList = new Map<string, { reject: Function, success: Function }>()
type Request = { id: string, args: any[], respond_to: string, requested_time: number }
type Response = { success: boolean, data?: any, message?: string, id: string }



export class AMQP {

    static channel: Channel

    static local_response_queue = `${process.env.QUEUE_PREFIX || ''}|local-response-${v4()}-${Date.now()}`

    private static connection: Connection

    private static listeners = new Set()

    static async init(url?: string) {

        const connection_url = url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789'

        const connect = async (n: number = 0) => {
            if (n != 0) {
                console.log(`${n}.Retry to connect rabbitMQ in 5s`)
                await new Promise(s => setTimeout(s, 5000))
            }
            this.connection = new Connection(connection_url)
            try {
                await this.connection.init()
                this.channel = await this.connection.createChannel()
            } catch (e) {
                console.error(e)
                return connect(n + 1)
            }
            this.connection.on('error', e => (console.error(e), connect(n + 1)))
            this.channel.on('error', e => (console.error(e), connect(n + 1)))
            console.log('AMQP inited')
            this.listeners.size > 0 && console.log(`Re - actived ${this.listeners.size} consumers & subscribers`)

            for (const listener of this.listeners) {
                await activeResponders(listener)
                await activeSubscribers(listener)
            }

            for (const listener of this.listeners) {
                if (Reflect.hasMetadata(ON_RECONNECT_CALLBACK, listener)) {
                    const method = Reflect.getMetadata(ON_RECONNECT_CALLBACK, listener)
                    listener[method]()
                }
            }

            // Active request by name
            const { queue } = await AMQP.channel.assertQueue(AMQP.local_response_queue, { exclusive: true, durable: false })

            await AMQP.channel.consume(queue, async msg => {
                const { id, success, data, message } = JSON.parse(msg.content) as Response
                if (ResponseCallbackList.has(id)) {
                    const cb = ResponseCallbackList.get(id)
                    success ? cb.success(data) : cb.reject(message)
                    ResponseCallbackList.delete(id)
                }
            }, { noAck: true })
        }
        await connect(0)
    }

    static connect() {
        const add = target => this.listeners.add(target)
        return (C: any) => {
            return class extends C {
                constructor(...props) {
                    super(...props)
                    setImmediate(async () => {
                        await activeResponders(this)
                        await activeSubscribers(this)
                        add(this)
                        if (Reflect.hasMetadata(ON_READY_CALLBACK, this)) {
                            const on_ready_callback_method = Reflect.getMetadata(ON_READY_CALLBACK, this)
                            this[on_ready_callback_method]()
                        }
                    })
                }
            } as any
        }
    }

    static async getChannel(options: { limit: number }) {
        if (!options.limit) return this.channel
        try {
            const channel = await this.connection.createChannel()
            await channel.prefetch(options.limit)
            return channel
        } catch (e) {
            throw new Error('Can not get AMQP channel, connection drop or not inited')
        }
    }

    static async requestToService<T>(req: {
        name: string,
        to?: string,
        method: string,
        args?: any[]
    }) {
        const { args, method, name, to } = req

        const id = v4()

        const data = Buffer.from(JSON.stringify({
            args: args || [],
            id,
            respond_to: AMQP.local_response_queue
        } as Request))

        return await new Promise<T>(async (success, reject) => {
            ResponseCallbackList.set(id, { success, reject })
            to ? await AMQP.channel.publish(`${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`, to, data) : await AMQP.channel.sendToQueue(
                `${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`,
                data
            )
        })
    }
}

export const AmqpService = () => AMQP.connect()