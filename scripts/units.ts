
function getMultiplier(decimals: number): bigint {
    let x = 1n;
    for (let i = 0; i < decimals; i++) {
        x *= 10n;
    }
    return x;
}

export function toUnits(src: string | bigint, decimals: number): bigint {
    const MULTIPLIER = getMultiplier(decimals);

    if (typeof src === 'bigint') {
        return src * MULTIPLIER;
    } else {

        // Check sign
        let neg = false;
        while (src.startsWith('-')) {
            neg = !neg;
            src = src.slice(1);
        }

        // Split string
        if (src === '.') {
            throw Error('Invalid number');
        }
        let parts = src.split('.');
        if (parts.length > 2) {
            throw Error('Invalid number');
        }

        // Prepare parts
        let whole = parts[0];
        let frac = parts[1];
        if (!whole) {
            whole = '0';
        }
        if (!frac) {
            frac = '0';
        }
        if (frac.length > decimals) {
            throw Error('Invalid number');
        }
        while (frac.length < decimals) {
            frac += '0';
        }

        // Convert
        let r = BigInt(whole) * MULTIPLIER + BigInt(frac);
        if (neg) {
            r = -r;
        }
        return r;
    }
}

export function fromUnits(src: bigint | string, decimals: number): string {
    const MULTIPLIER = getMultiplier(decimals);

    let v = BigInt(src);
    let neg = false;
    if (v < 0) {
        neg = true;
        v = -v;
    }

    // Convert fraction
    let frac = v % MULTIPLIER;
    let facStr = frac.toString();
    while (facStr.length < decimals) {
        facStr = '0' + facStr;
    }
    facStr = facStr.match(/^([0-9]*[1-9]|0)(0*)/)![1];

    // Convert whole
    let whole = v / MULTIPLIER;
    let wholeStr = whole.toString();

    // Value
    let value = `${wholeStr}${facStr === '0' ? '' : `.${facStr}`}`;
    if (neg) {
        value = '-' + value;
    }

    return value;
}