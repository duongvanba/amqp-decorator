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

    private static async activeClass(target: any, n: number = 0) {
        await activeResponders(target)
        await activeSubscribers(target)
        const event = n == 0 ? ON_READY_CALLBACK : ON_RECONNECT_CALLBACK
        if (Reflect.hasMetadata(event, target)) {
            const method = Reflect.getMetadata(event, target)
            target[method]()
        }
    }

    static async init(url?: string) {

        const connection_url = url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789'

        await new Promise(async done => {
            for (let n = 0; true; n++) {

                try {
                    this.connection = new Connection(connection_url)
                    await this.connection.init()

                    this.channel = await this.connection.createChannel()

                    // Active all listener
                    for (const listener of this.listeners) this.activeClass(listener, n)

                    // Active request by name
                    const { queue } = await this.channel.assertQueue(this.local_response_queue, { exclusive: true, durable: false })

                    await this.channel.consume(queue, async msg => {
                        const { id, success, data, message } = JSON.parse(msg.content) as Response
                        if (ResponseCallbackList.has(id)) {
                            const cb = ResponseCallbackList.get(id)
                            success ? cb.success(data) : cb.reject(message)
                            ResponseCallbackList.delete(id)
                        }
                    }, { noAck: true })

                    done()

                    await new Promise((s, r) => {
                        this.connection.on('error', r)
                        this.channel.on('error', r)
                    })

                } catch (e) {
                    console.error(e)
                    console.log(`[${n} time(s)] Retry in 5s`)
                    await new Promise(s => setTimeout(s, 5000))
                }
            }
        })
    }

    static connect() {
        const process = target => {
            this.listeners.add(target)
            this.activeClass(target)
        }
        return (C: any) => {
            return class extends C {
                constructor(...props) {
                    super(...props)
                    process(this)
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