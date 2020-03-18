import 'reflect-metadata'
import { Connection, Channel } from "amqplib-as-promised/lib"
import { activeResponders } from './request-response'
import { activeSubscribers } from './pub-sub'


export class AMQP {

    static channel: Channel

    private static connection: Connection

    private static listeners = new Set()

    static async init(url?: string) {

        const connection_url = url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789'

        const connect = async (n: number = 0) => {
            if (n != 0) {
                console.log(`${n}. Retry to connect rabbitMQ in 5s`)
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
            this.listeners.size > 0 && console.log(`Re-actived ${this.listeners.size} consumers & subscribers`)
            for (const listener of this.listeners) {
                activeResponders(listener)
                activeSubscribers(listener)
            }
        }
        await connect(0)
    }

    static connect() {
        const add = target => this.listeners.add(target)
        return (C: any) => {
            return class extends C {
                constructor(...props) {
                    super(...props)
                    activeResponders(this)
                    activeSubscribers(this)
                    add(this)
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
}

export const AmqpService = () => AMQP.connect()