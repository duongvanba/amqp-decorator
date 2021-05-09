import { Options } from "amqplib"
import { Channel } from "amqplib-as-promised/lib"
import { AMQP } from "./AMQP"
import { waitFor } from "./waitFor"



const AMQP_SUBSCRIBERS = Symbol.for('AMQP_SUBSCRIBES')


type PubSubQueueOptions = {
    limit?: number,
    active_when?: (target: any) => boolean | Promise<boolean>
}

type EventMetadata = PubSubQueueOptions & {
    method: string,
    event_name: string
}




export const createAmqpEvent = <T extends {}>(event_name: string) => {

    return {
        publish: async (data: T = {} as T) => {
            const exchange = `${process.env.QUEUE_PREFIX || ''}|pubsub|${event_name}`
            await AMQP.channel.assertExchange(exchange, 'fanout')
            await AMQP.channel.publish(exchange, '', Buffer.from(JSON.stringify({ data, published_at: Date.now() })))
        },

        subscribe: (options: PubSubQueueOptions = {}) => (
            target: any,
            method: string,
            handler: TypedPropertyDescriptor<(data?: T, published_at?: number) => Promise<void>>
        ) => {
            const list: EventMetadata[] = Reflect.getMetadata(AMQP_SUBSCRIBERS, target) || []
            list.push({ event_name, method, ...options })
            Reflect.defineMetadata(AMQP_SUBSCRIBERS, list, target)
        }
    }
}

export const activeSubscribers = async (target: any) => {

    const subscribers = (Reflect.getMetadata(AMQP_SUBSCRIBERS, target) || []) as EventMetadata[]
    const promies = subscribers.map(async ({ method, event_name, limit, active_when }) => {

        const channel: Channel = await AMQP.getChannel({ limit })
        const exchange = `${process.env.QUEUE_PREFIX || ''}|pubsub|${event_name}`
        await channel.assertExchange(exchange, 'fanout')
        const { queue } = await channel.assertQueue('', { exclusive: true, durable: false })
        await channel.bindQueue(queue, exchange, '')
        const subscribler_class_name = Object.getPrototypeOf(Object.getPrototypeOf(target)).constructor.name

        setImmediate(async () => {
            active_when && await waitFor(() => active_when(target))
            await channel.consume(
                queue,
                async msg => {
                    try {
                        const { data, published_at } = JSON.parse(msg.content.toString()) as { data: any, published_at: number }
                        await target[method](data, published_at)
                    } catch (e) {
                        console.error(e)
                    }
                },
                { noAck: true, consumerTag: `event:${event_name}#${subscribler_class_name}-${method}` }
            )
        })
    })

    await Promise.all(promies)
}
