import { AmqpService, AmqpResponder } from '../src/AMQP'

@AmqpService()
export class ServiceX {
    private a = Date.now()

    @AmqpResponder({
        id: (s: ServiceX) => {
            const id = `${s.a}`
            console.log({ Responder: { id } })
            return id
        }
    }
    )
    async some_method() {
        console.log('Called')
        return {
            a: 'bc'
        }
    }
}