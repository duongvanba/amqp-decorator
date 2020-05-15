import { ON_READY_CALLBACK, ON_RECONNECT_CALLBACK } from "./symbol"

export const AmqpOnReady = () => (
    target: any,
    method: string
) => {
    Reflect.defineMetadata(ON_READY_CALLBACK, method, target) 
}

export const AmqpOnReconnect = () => (
    target: any,
    method: string
) => {
    Reflect.defineMetadata(ON_RECONNECT_CALLBACK, method, target) 
}