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
require("reflect-metadata");
const lib_1 = require("amqplib-as-promised/lib");
const request_response_1 = require("./request-response");
const pub_sub_1 = require("./pub-sub");
const symbol_1 = require("./symbol");
class AMQP {
    static init(url) {
        return __awaiter(this, void 0, void 0, function* () {
            const publish_connection = new lib_1.Connection(url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789');
            yield publish_connection.init();
            this.publish_channel = yield publish_connection.createChannel();
            this.consume_connection = new lib_1.Connection(url || process.env.RABBIT_MQ_URL || 'amqp://localhost:6789');
            yield this.consume_connection.init();
            this.consume_channel = yield this.consume_connection.createChannel();
            this.consume_channel.prefetch(1);
            console.log('AMQP inited');
        });
    }
    static connect() {
        return (C) => {
            Reflect.defineMetadata(symbol_1.AMQP_DECORATER_INITED, 'ahihi', C);
            return class extends C {
                constructor(...props) {
                    super(...props);
                    request_response_1.activeResponders(this);
                    pub_sub_1.activeSubscribers(this);
                }
            };
        };
    }
    static getChannel(options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!options.limit)
                return this.consume_channel;
            try {
                const channel = yield this.consume_connection.createChannel();
                yield channel.prefetch(options.limit);
                return channel;
            }
            catch (e) {
                throw new Error('Can not get AMQP channel, connection drop or not inited');
            }
        });
    }
}
exports.AMQP = AMQP;
exports.AmqpService = () => AMQP.connect();
