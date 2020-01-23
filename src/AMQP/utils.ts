import { Provider } from "@nestjs/common"
import { AmqpRemoteService } from "./request-response"

export const default_on_timeout = async <T>(task: Promise<T>, timeout: number, value: T) => new Promise(async (success, reject) => {
    setTimeout(() => success(value), timeout)
    try {
        success(await task)
    } catch (e) {
        reject(e)
    }
})

export const error_on_timeout = async <T>(task: Promise<T>, timeout: number) => new Promise(async (success, reject) => {
    setTimeout(reject, timeout)
    try {
        success(await task)
    } catch (e) {
        reject(e)
    }
})

export const AmqpRemoteServiceProvider = (provide: any) => ({
    provide,
    useFactory: () => AmqpRemoteService(provide)
} as Provider)