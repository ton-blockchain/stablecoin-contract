export abstract class Op {
    static transfer = 0xf8a7ea5;
    static transfer_notification = 0x7362d09c;
    static internal_transfer = 0x178d4519;
    static excesses = 0xd53276db;
    static burn = 0x595f07bc;
    static burn_notification = 0x7bdd97de;
    
    static provide_wallet_address = 0x2c76b973;
    static take_wallet_address = 0xd1735400;
    static mint = 21;
    static change_admin = 3;
    static claim_admin = 4;
    static upgrade = 5;
    static call_to = 6;
    static top_up = 7;
    static change_metadata_url = 8;
    static set_status = 100
}

export abstract class Errors {
    static invalid_op = 72;
    static wrong_op = 0xffff;
    static not_owner = 73;
    static not_valid_wallet = 74;
    static wrong_workchain = 333;
    
    static contract_locked = 45;
    static balance_error = 47;
    static not_enough_gas = 48;
    static invalid_mesage = 49;
    static discovery_fee_not_matched = 75;
}


