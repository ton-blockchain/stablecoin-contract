import { sleep, NetworkProvider, UIProvider} from '@ton-community/blueprint';
import { Address, Cell } from "ton-core";

export const promptBool    = async (prompt:string, options:[string, string], ui:UIProvider) => {
    let yes  = false;
    let no   = false;
    let opts = options.map(o => o.toLowerCase());

    do {
        let res = (await ui.input(prompt)).toLowerCase();
        yes = res == opts[0]
        if(!yes)
            no  = res == opts[1];
    } while(!(yes || no));

    return yes;
}

export const promptAddress = async (prompt:string, provider:UIProvider, fallback?:Address) => {
    let promptFinal = fallback ? prompt.replace(/:$/,'') + `(default:${fallback}):` : prompt ;
    do {
        let testAddr = (await provider.input(promptFinal)).replace(/^\s+|\s+$/g,'');
        try{
            return testAddr == "" && fallback ? fallback : Address.parse(testAddr);
        }
        catch(e) {
            provider.write(testAddr + " is not valid!\n");
            prompt = "Please try again:";
        }
    } while(true);

};

export const promptAmount = async (prompt:string, provider:UIProvider) => {
    let resAmount:number;
    do {
        let inputAmount = await provider.input(prompt);
        resAmount = Number(inputAmount);
        if(isNaN(resAmount)) {
            provider.write("Failed to convert " + inputAmount + " to float number");
        }
        else {
            return resAmount.toFixed(9);
        }
    } while(true);
}

export const waitForTransaction = async (provider:NetworkProvider, address:Address, curTx:string | null, maxRetry:number, interval:number=1000) => {
    let done  = false;
    let count = 0;
    const ui  = provider.ui();

    do {
        ui.write(`Awaiting transaction completion (${++count}/${maxRetry})`);
        await sleep(interval);
        const curState = await provider.api().getContractState(address);
        if(curState.lastTransaction !== null){
            done = curState.lastTransaction.lt !== curTx;
        }
    } while(!done && count < maxRetry);
    return done;
}

export const displayContentCell = (content:Cell, ui:UIProvider) => {
    const cs = content.beginParse();
    const contentType = cs.loadUint(8);
    switch (contentType){
        case 1:
            const noData = cs.remainingBits == 0;
            if(noData && cs.remainingRefs == 0) {
                ui.write("No data in content cell!\n");
            }
            else {
                const contentUrl = noData ? cs.loadStringRefTail() : cs.loadStringTail();
                ui.write(`Content metadata url:${contentUrl}\n`);
            }
            break;
        case 0:
            ui.write("On chain format not supported yet!\n");
            break;
        default:
            ui.write(`Unknown content format indicator:${contentType}\n`);
        
    }
}

export const promptUrl = async(prompt:string, ui:UIProvider) => {
    let retry  = false;
    let input  = "";
    let res    = "";

    do {
        input = await ui.input(prompt);
        try{
            let testUrl = new URL(input);
            res   = testUrl.toString();
            retry = false;
        }
        catch(e) {
            ui.write(input + " doesn't look like a valid url:\n" + e);
            retry = !(await promptBool('Use anyway?(y/n)', ['y', 'n'], ui));
        }
    } while(retry);
    return input;
}
