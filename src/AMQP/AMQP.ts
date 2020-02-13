import 'reflect-metadata'
import { Connection, Channel } from "amqplib-as-promised/lib"
import { activeResponders } from './request-response'
import { activeSubscribers } from './pub-sub'
import { AMQP_DECORATER_INITED } from './symbol'


export class AMQP {

    static publish_channel: Channel
    static consume_channel: Channel

    private static consume_connection: Connection
    

    static async init(url?: string) {
        const publish_connection = new Connection(url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789')
        await publish_connection.init()
        this.publish_channel = await publish_connection.createChannel()

        this.consume_connection = new Connection(url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789')
        await this.consume_connection.init()

        this.consume_channel = await this.consume_connection.createChannel()
        this.consume_channel.prefetch(1)
        console.log('AMQP inited')
    }

    static connect() {
        return (C: any) => {
            Reflect.defineMetadata(AMQP_DECORATER_INITED, 'ahihi', C)
            return class extends C {
                constructor (...props) {
                    super(...props)
                    activeResponders(this)
                    activeSubscribers(this)
                }
            } as any
        }
    }

    static async getChannel(options: { limit: number }) {
        if (!options.limit) return this.consume_channel
        try {
            const channel = await this.consume_connection.createChannel()
            await channel.prefetch(options.limit)
            return channel
        } catch (e) {
            throw new Error('Can not get AMQP channel, connection drop or not inited')
        }
    }
}

export const AmqpService = () => AMQP.connect()