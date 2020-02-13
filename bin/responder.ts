import {AMQP} from '../src/AMQP'
import {ServiceX} from './ServiceX'

setImmediate(async() => {
    await AMQP.init()
    new ServiceX()
})