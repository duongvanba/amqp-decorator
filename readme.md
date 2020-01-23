# AMQP DECORATOR FOR NODEJS TYPESCRIPT
 amqp-decorator help you to build microservice with typescript level, you can call a service from anywhere with amqp procol. Support request response round round robin, direct request, publish subscrible
 # 1. Install
 ```bash
 npm i amqp-decorator
 ```
 or with yarn
 ```bash
 yarn add amqp-decorator
 ```
 # 2. Usage
 
 To make sure AMQP inited before programs run, make sure you inited AMQP at first (in async funcrtion)
 ```typescript
import {AMQP} from 'amqp-decorator'

setImmediate(async() => {
   await AMQP.init(amqp_url) // amqp_url = 'amqp://localhost:6789' default
   // ... Other inited here
})
 ```
 
 #### - Request response pattern
 For example, we define 01 service, 01 consumer and 01 worker 
 ```typescript
 // ServiceX.ts
 import { AmqpService, AmqpResponder } from 'amqp-decorator'
 
 @AmqpService()
 class ServiceX{
 
     @AmqpResponder()
     async some_method(){
         return 'This is response from remote service'
     }
 }
 ```
 ```typescript
 // responder.ts
 import {AMQP} from 'amqp-decorator'
 import {ServiceX} from './ServiceX'
 
 setImmediate(async() => {
     await AMQP.init()
     new ServiceX()
 })
 ```
 
 ```typescript
 // resquester.ts
 import { AMQP, AmqpRemoteService } from 'amqp-decorator'
 import { ServiceX } from './ServiceX'
 
 setImmediate(async() => {
    await AMQP.init()
    const service_x = await AmqpRemoteService<ServiceX>(ServiceX)
    console.log(await x.some_method()) // =>  This is response from remote service
 })
 ```
 you can use addtional options
 ```typescript
@AmqpService()
class X{
    
     @AmqpResponder({
         limit: number // Max concurrent call function in same time
         active_when: (x: X) => Promise<boolean> // Consumer will listening until condition return true
         id: string | Promise<string> | (x: X) => Promise<string> // Function return id of this consumer, to use direct request
         process_old_requests: boolean // Process requests before consumer start?
    })
    
    ...
}
 
 ```
 ##### *** Direct request
 When you have many responders in system, you can set options to define uniqueue id for this responder. Then in requester, you can use .to(id: string) method to send request direct to extract responder you want
 
  ##### *** Error catching
  If you throw an ERROR from responder, it will result an Error in resquester
  
  ##### *** Use with nestjs
  You can import a class as remote service by use "AmqpRemoteServiceProvider"
  Instead 
```typescript
import { AmqpRemoteServiceProvider } from 'amqp-decorator'

@Module({
providers: [
        RemoteSerivce
]
})
export class WorkerComposerAppModule { }
```
  just change to
```typescript
import { AmqpRemoteServiceProvider } from 'amqp-decorator'

@Module({
providers: [
        AmqpRemoteServiceProvider(RemoteSerivce), // wrapped by AmqpRemoteServiceProvider
    ]
})
export class WorkerComposerAppModule { }
  ```
  Now you can run this service from remote server to current server
 
  #### - Event publish subscribe
  To use event publish - subscrible, you must define events
  ```typescript
  // some-event.ts
  import { createAmqpEvent } from 'amqp-decorator'
  export const some_event = await createAmqpEvent<{x: string}>('some_event')
  ```
  
```typescript
  // publisher.ts
import { AMQP } from 'amqp-decorator'
import { some_event } from './some_event'
    
setImmediate(async() => {
   await AMQP.init()
   await some_event.publish({x: 'vvvv'})
})
```
 
```typescript
  // subscriber.ts
import { AMQP } from 'amqp-decorator'
import { some_event } from './some_event'

@AmqpService()
class X{
    
    @some_event.subscribe()
    async event_process(data: {x: string}){
        console.log(data) // {x: 'vvv'}
    }
}
    
setImmediate(async() => {
   await AMQP.init()
   new X() // You must instance class to listen events
})
```