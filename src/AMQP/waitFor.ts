export async function waitFor(condition: (...args: any[]) => boolean | Promise<boolean>, duration?: number, ping_delay?: number) {
    await new Promise(async (s,r) => {
        try{
            duration && setTimeout(s, duration * 1000)
        while (true) {
            if (await condition()) {
                s()
                break;
            }
            await sleep(ping_delay | 2)
        }
        }catch(e){
            r()
        }
    })
}