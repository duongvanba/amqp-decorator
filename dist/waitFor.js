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
function waitFor(condition, duration, ping_delay) {
    return __awaiter(this, void 0, void 0, function* () {
        yield new Promise((s, r) => __awaiter(this, void 0, void 0, function* () {
            try {
                duration && setTimeout(s, duration * 1000);
                while (true) {
                    if (yield condition()) {
                        s();
                        break;
                    }
                    yield new Promise(s => setTimeout(s, 1000 * (ping_delay | 2)));
                }
            }
            catch (e) {
                r();
            }
        }));
    });
}
exports.waitFor = waitFor;
