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
const request_response_1 = require("./request-response");
exports.default_on_timeout = (task, timeout, value) => __awaiter(void 0, void 0, void 0, function* () {
    return new Promise((success, reject) => __awaiter(void 0, void 0, void 0, function* () {
        setTimeout(() => success(value), timeout);
        try {
            success(yield task);
        }
        catch (e) {
            reject(e);
        }
    }));
});
exports.error_on_timeout = (task, timeout) => __awaiter(void 0, void 0, void 0, function* () {
    return new Promise((success, reject) => __awaiter(void 0, void 0, void 0, function* () {
        setTimeout(reject, timeout);
        try {
            success(yield task);
        }
        catch (e) {
            reject(e);
        }
    }));
});
exports.AmqpRemoteServiceProvider = (provide) => ({
    provide,
    useFactory: () => request_response_1.AmqpRemoteService(provide)
});
