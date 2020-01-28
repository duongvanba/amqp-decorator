"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const AMQP_1 = require("./AMQP");
const waitFor_1 = require("./waitFor");
const AMQP_SUBSCRIBERS = Symbol.for('AMQP_SUBSCRIBES');
exports.createAmqpEvent = (event_name) => {
    return {
        publish: (data = {}) => __awaiter(void 0, void 0, void 0, function* () {
            const exchange = `${process.env.QUEUE_PREFIX || ''}|pubsub|${event_name}`;
            yield AMQP_1.AMQP.publish_channel.assertExchange(exchange, 'fanout');
            yield AMQP_1.AMQP.publish_channel.publish(exchange, '', Buffer.from(JSON.stringify({ data, published_at: Date.now() })));
        }),
        subscribe: (options = {}) => (target, method, handler) => {
            const list = Reflect.getMetadata(AMQP_SUBSCRIBERS, target) || [];
            list.push(Object.assign({ event_name, method }, options));
            Reflect.defineMetadata(AMQP_SUBSCRIBERS, list, target);
        }
    };
};
exports.activeSubscribers = (target) => __awaiter(void 0, void 0, void 0, function* () {
    const subscribers = (Reflect.getMetadata(AMQP_SUBSCRIBERS, target) || []);
    for (const { method, event_name, limit, active_when } of subscribers) {
        const channel = yield AMQP_1.AMQP.getChannel({ limit });
        const exchange = `${process.env.QUEUE_PREFIX || ''}|pubsub|${event_name}`;
        yield channel.assertExchange(exchange, 'fanout');
        const { queue } = yield channel.assertQueue('', { exclusive: true, durable: false });
        yield channel.bindQueue(queue, exchange, '');
        active_when && (yield waitFor_1.waitFor(() => active_when(target)));
        const subscribler_class_name = Object.getPrototypeOf(Object.getPrototypeOf(target)).constructor.name;
        yield channel.consume(queue, (msg) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const { data, published_at } = JSON.parse(msg.content.toString());
                yield target[method](data, published_at);
            }
            catch (e) {
                console.error(e);
            }
        }), { noAck: true, consumerTag: `event:${event_name}#${subscribler_class_name}-${method}` });
    }
});
