import 'reflect-metadata'
import { Connection, Channel } from "amqplib-as-promised/lib"
import { activeResponders } from './request-response'
import { activeSubscribers } from './pub-sub'


export class AMQP {

    static channel: Channel

    private static connection: Connection


    static async init(url?: string) {
        this.connection = new Connection(url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789')
        await this.connection.init()
        this.connection.on('error', () => {
            console.log('Connection error')
        })
        this.channel = await this.connection.createChannel()
        this.channel.on('error', () => {
            console.log('Channel error')
        })
        console.log('AMQP inited')
    }

    static connect() {
        return (C: any) => {
            return class extends C {
                constructor(...props) {
                    super(...props)
                    activeResponders(this)
                    activeSubscribers(this)
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