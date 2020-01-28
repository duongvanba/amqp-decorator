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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const waitFor_1 = require("./waitFor");
const symbol_1 = require("./symbol");
const AMQP_1 = require("./AMQP");
const uuid_1 = require("uuid");
const AMQP_RESPONDER_QUEUES = Symbol.for('AMQP_RESPONDER_QUEUES');
const Callbacks = new Map();
exports.AmqpResponder = (options = {}) => (target, method) => {
    const list = Reflect.getMetadata(AMQP_RESPONDER_QUEUES, target) || [];
    list.push(Object.assign({ method, process_old_requests: false }, options));
    Reflect.defineMetadata(AMQP_RESPONDER_QUEUES, list, target);
};
exports.getKey = (key) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof key == 'function')
        return yield key();
    return yield key;
});
exports.activeResponders = (target) => __awaiter(void 0, void 0, void 0, function* () {
    const request_name = Object.getPrototypeOf(Object.getPrototypeOf(target)).constructor.name;
    const responders = (Reflect.getMetadata(AMQP_RESPONDER_QUEUES, target) || []);
    const promises = responders.map(({ method, active_when, limit, id, process_old_requests }) => __awaiter(void 0, void 0, void 0, function* () {
        active_when && (yield waitFor_1.waitFor(() => active_when(target)));
        const started_time = Date.now();
        const channel = yield AMQP_1.AMQP.getChannel({ limit });
        const queue = `${process.env.QUEUE_PREFIX || ''}|amqp|request::${request_name}-${method}`;
        const message_handler = (msg) => __awaiter(void 0, void 0, void 0, function* () {
            const request = JSON.parse(msg.content.toString());
            if (!process_old_requests && request.requested_time < started_time)
                return yield channel.ack(msg);
            try {
                const result = (yield target[method](...request.args)) || {};
                if (typeof result == 'object' && result[symbol_1.WAITFOR]) {
                    const _a = symbol_1.WAITFOR, wait_long_task = result[_a], data = __rest(result, [typeof _a === "symbol" ? _a : _a + ""]);
                    const response = { id: request.id, success: true, data };
                    channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)));
                    yield wait_long_task();
                }
                else {
                    const response = { id: request.id, success: true, data: result };
                    AMQP_1.AMQP.publish_channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)));
                }
            }
            catch (e) {
                const message = typeof e == 'string' ? e : e.message;
                const response = { id: request.id, success: false, message };
                channel.sendToQueue(request.respond_to, Buffer.from(JSON.stringify(response)));
            }
            yield channel.ack(msg);
        });
        yield channel.assertQueue(queue, { durable: false });
        channel.consume(queue, message_handler, { noAck: false, consumerTag: `${request_name}-${method}-responder-${uuid_1.v4()}` });
        if (id) {
            const key = yield exports.getKey(id);
            yield channel.assertExchange(queue, 'direct');
            const { queue: direct_request_queue } = yield channel.assertQueue('', { exclusive: true });
            yield channel.bindQueue(direct_request_queue, queue, key);
            yield channel.consume(direct_request_queue, message_handler, { noAck: false, consumerTag: `${request_name}-${method}-responder-${uuid_1.v4()}` });
        }
    }));
    yield Promise.all(promises);
});
exports.AmqpRemoteService = (target) => __awaiter(void 0, void 0, void 0, function* () {
    if (!AMQP_1.AMQP.publish_channel)
        throw new Error('Init amqp connection before tasks');
    const inited = Reflect.getMetadata(symbol_1.AMQP_DECORATER_INITED, target);
    const client_class = target.prototype;
    const name = client_class.constructor.name;
    if (!inited)
        throw new Error('MISSING AMQP INIT DECORATOR for ' + name);
    const responders = Reflect.getMetadata(AMQP_RESPONDER_QUEUES, client_class) || [];
    const respond_to_queues = new Map();
    const promises = responders.map((r) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const queue = `${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${r.method}`;
            yield AMQP_1.AMQP.publish_channel.assertQueue(queue, { durable: false });
            const { queue: respond_to_queue } = yield AMQP_1.AMQP.publish_channel.assertQueue(`${queue}|${uuid_1.v4()}`, { durable: false });
            respond_to_queues.set(r.method, respond_to_queue);
            yield AMQP_1.AMQP.consume_channel.consume(respond_to_queue, (msg) => __awaiter(void 0, void 0, void 0, function* () {
                const { id, data, success, message } = JSON.parse(msg.content.toString());
                if (Callbacks.has(id)) {
                    success ? Callbacks.get(id).success(data) : Callbacks.get(id).reject(message);
                    Callbacks.delete(id);
                }
            }), { noAck: true });
        }
        catch (e) {
            console.log('Error here', e);
        }
    }));
    yield Promise.all(promises);
    return new Proxy(target, {
        get: (_, prop) => {
            if (prop == 'to')
                return key => new Proxy({}, {
                    get: (_, prop) => (...args) => __awaiter(void 0, void 0, void 0, function* () {
                        const method = prop;
                        if (!respond_to_queues.has(method))
                            throw new Error(`Missing decorator for method ${name}.${method} *`);
                        const id = uuid_1.v4();
                        const data = Buffer.from(JSON.stringify({ args, id, respond_to: respond_to_queues.get(method) }));
                        return yield new Promise((success, reject) => __awaiter(void 0, void 0, void 0, function* () {
                            Callbacks.set(id, { success, reject });
                            yield AMQP_1.AMQP.publish_channel.publish(`${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`, key, data);
                        }));
                    })
                });
            if (!respond_to_queues.has(prop))
                return undefined;
            return (...args) => __awaiter(void 0, void 0, void 0, function* () {
                const method = prop;
                const id = uuid_1.v4();
                const data = Buffer.from(JSON.stringify({ args, id, respond_to: respond_to_queues.get(method), requested_time: Date.now() }));
                return yield new Promise((success, reject) => __awaiter(void 0, void 0, void 0, function* () {
                    Callbacks.set(id, { success, reject });
                    yield AMQP_1.AMQP.publish_channel.sendToQueue(`${process.env.QUEUE_PREFIX || ''}|amqp|request::${name}-${method}`, data);
                }));
            });
        }
    });
});
