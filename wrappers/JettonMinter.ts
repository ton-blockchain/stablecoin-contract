import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';
import { JettonWallet } from './JettonWallet';
import { Op, Errors } from './JettonConstants';

export type JettonMinterContent = {
    type:0|1,
    uri:string
};
export type JettonMinterConfig = {admin: Address,  wallet_code: Cell};

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    return  beginCell()
                .storeCoins(0)
                .storeAddress(config.admin)
                .storeAddress(null) // Transfer admin address
                .storeRef(config.wallet_code)
            .endCell();
}

export function jettonContentToCell(content:JettonMinterContent) {
    return beginCell()
                      .storeUint(content.type, 8)
                      .storeStringTail(content.uri) //Snake logic under the hood
           .endCell();
}

export class JettonMinter implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new JettonMinter(address);
    }

    static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonMinterConfigToCell(config);
        const init = { code, data };
        return new JettonMinter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    static mintMessage(to: Address, jetton_amount: bigint, from?: Address | null, response?: Address | null, customPayload?: Cell | null, forward_ton_amount: bigint = 0n, total_ton_amount: bigint = 0n) {
		const mintMsg = beginCell().storeUint(Op.internal_transfer, 32)
                                   .storeUint(0, 64)
                                   .storeCoins(jetton_amount)
                                   .storeAddress(from)
                                   .storeAddress(response)
                                   .storeCoins(forward_ton_amount)
                                   .storeMaybeRef(customPayload)
                        .endCell();
        return beginCell().storeUint(Op.mint, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(to)
                          .storeCoins(total_ton_amount)
                          .storeRef(mintMsg)
               .endCell();
    }

    async sendMint(provider: ContractProvider,
				   via: Sender,
				   to: Address,
				   jetton_amount:bigint,
				   from?: Address | null,
				   response_addr?: Address | null,
				   customPayload?: Cell | null,
				   forward_ton_amount: bigint = toNano('0.05'), total_ton_amount: bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.mintMessage(to, jetton_amount, from, response_addr, customPayload, forward_ton_amount, total_ton_amount),
            value: total_ton_amount,
        });
    }

    /* provide_wallet_address#2c76b973 query_id:uint64 owner_address:MsgAddress include_address:Bool = InternalMsgBody;
    */
    static discoveryMessage(owner: Address, include_address: boolean) {
        return beginCell().storeUint(0x2c76b973, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(owner).storeBit(include_address)
               .endCell();
    }

    async sendDiscovery(provider: ContractProvider, via: Sender, owner: Address, include_address: boolean, value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.discoveryMessage(owner, include_address),
            value: value,
        });
    }

    static changeAdminMessage(newOwner: Address) {
        return beginCell().storeUint(Op.change_admin, 32).storeUint(0, 64) // op, queryId
                          .storeAddress(newOwner)
               .endCell();
    }

    async sendChangeAdmin(provider: ContractProvider, via: Sender, newOwner: Address) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeAdminMessage(newOwner),
            value: toNano("0.1"),
        });
    }

    static claimAdminMessage(query_id: bigint = 0n) {
        return beginCell().storeUint(Op.claim_admin, 32).storeUint(query_id, 64).endCell();
    }

    async sendClaimAdmin(provider: ContractProvider, via: Sender, query_id:bigint = 0n) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.claimAdminMessage(query_id),
            value: toNano('0.1')
        })
    }
    static changeContentMessage(content: Cell) {
        return beginCell().storeUint(0x5773d1f5, 32).storeUint(0, 64) // op, queryId
                          .storeRef(content)
               .endCell();
    }

    async sendChangeContent(provider: ContractProvider, via: Sender, content: Cell) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.changeContentMessage(content),
            value: toNano("0.1"),
        });
    }
    static lockWalletMessage(lock_address: Address, lock: boolean = true, amount: bigint, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
                          .storeAddress(lock_address)
                          .storeCoins(amount)
                          .storeRef(beginCell().storeUint(Op.set_status, 32).storeUint(query_id, 64).storeUint(Number(lock), 4).endCell())
               .endCell();
    }
    async sendLockWallet(provider: ContractProvider, via: Sender, lock_address: Address, lock: boolean, amount: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.lockWalletMessage(lock_address, lock, amount, query_id),
            value: amount + toNano('0.1')
        });
    }
    static forceTransferMessage(transfer_amount: bigint,
                            to: Address,
                            from: Address,
                            custom_payload: Cell | null,
                            forward_amount: bigint = 0n,
                            forward_payload: Cell | null,
                            value: bigint = toNano('0.1'),
                            query_id: bigint = 0n) {

        const transferMessage = JettonWallet.transferMessage(transfer_amount,
                                                                 to,
                                                                 to,
                                                                 custom_payload,
                                                                 forward_amount,
                                                                 forward_payload);
        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
                          .storeAddress(from)
                          .storeCoins(value)
                          .storeRef(transferMessage)
              .endCell();
    }


    async sendForceTransfer(provider: ContractProvider,
                            via: Sender,
                            transfer_amount: bigint,
                            to: Address,
                            from: Address,
                            custom_payload: Cell | null,
                            forward_amount: bigint = 0n,
                            forward_payload: Cell | null,
                            value: bigint = toNano('0.1'),
                            query_id: bigint = 0n) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.forceTransferMessage(transfer_amount,
                                                    to, from,
                                                    custom_payload,
                                                    forward_amount,
                                                    forward_payload,
                                                    value, query_id),
            value: value + toNano('0.1')
        });
    }

    static forceBurnMessage(burn_amount: bigint,
                            to: Address,
                            response: Address | null,
                            value: bigint = toNano('0.1'),
                            query_id: bigint | number = 0) {

        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
                          .storeAddress(to)
                          .storeCoins(value)
                          .storeRef(JettonWallet.burnMessage(burn_amount, response, null))
               .endCell()
    }
    async sendForceBurn(provider: ContractProvider,
                        via: Sender,
                        burn_amount: bigint,
                        address: Address,
                        response: Address | null,
                        value: bigint = toNano('0.1'),
                        query_id: bigint | number = 0) {

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: JettonMinter.forceBurnMessage(burn_amount, address, response, value, query_id),
            value: value + toNano('0.1')
        });
    }
    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const res = await provider.get('get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(owner).endCell() }])
        return res.stack.readAddress()
    }

    async getJettonData(provider: ContractProvider) {
        let res = await provider.get('get_jetton_data', []);
        let totalSupply = res.stack.readBigNumber();
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();
        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode
        };
    }

    async getTotalSupply(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.totalSupply;
    }
    async getAdminAddress(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.adminAddress;
    }
    async getContent(provider: ContractProvider) {
        let res = await this.getJettonData(provider);
        return res.content;
    }
}
