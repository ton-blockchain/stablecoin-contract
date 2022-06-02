import fs from "fs";
import path from "path";
import process from "process";
import child_process from "child_process";
import glob from "fast-glob";

async function main() {
    console.log(`=================================================================`);
    console.log(`Build script running, let's find some FunC contracts to compile..`);

    // make sure func compiler is available
    let funcVersion = "";
    try {
        funcVersion = child_process.execSync("func -V").toString();
    } catch (e) { }
    if (!funcVersion.includes(`FunC`)) {
        console.log(`\nFATAL ERROR: 'func' executable is not found, is it installed and in path?`);
        process.exit(1);
    }

    // make sure fift cli is available
    let fiftVersion = "";
    try {
        fiftVersion = child_process.execSync("fift -V").toString();
    } catch (e) { }
    if (!fiftVersion.includes(`Fift build information`)) {
        console.log(`\nFATAL ERROR: 'fift' executable is not found, is it installed and in path?`);
        process.exit(1);
    }

    // go over all the root contracts in the contracts directory
    const rootContracts = [
        'contracts/jetton-minter.fc',
        'contracts/jetton-wallet.fc',
    ];
    for (const rootContract of rootContracts) {
        // compile a new root contract
        console.log(`\n* Found root contract '${rootContract}' - let's compile it:`);
        const contractName = path.parse(rootContract).name;

        // delete existing build artifacts
        const fiftArtifact = `build/${contractName}.fif`;
        if (fs.existsSync(fiftArtifact)) {
            console.log(` - Deleting old build artifact '${fiftArtifact}'`);
            fs.unlinkSync(fiftArtifact);
        }
        const funcArtifact = `build/${contractName}.fc`;
        if (fs.existsSync(funcArtifact)) {
            console.log(` - Deleting old build artifact '${funcArtifact}'`);
            fs.unlinkSync(funcArtifact);
        }
        const fiftCellArtifact = `build/${contractName}.cell.fif`;
        if (fs.existsSync(fiftCellArtifact)) {
            console.log(` - Deleting old build artifact '${fiftCellArtifact}'`);
            fs.unlinkSync(fiftCellArtifact);
        }
        const cellArtifact = `build/${contractName}.cell`;
        if (fs.existsSync(cellArtifact)) {
            console.log(` - Deleting old build artifact '${cellArtifact}'`);
            fs.unlinkSync(cellArtifact);
        }

        // run the func compiler to create a fif file
        console.log(` - Trying to compile '${funcArtifact}' with 'func' compiler..`);
        const buildErrors = child_process.execSync(`func -APS -o build/${contractName}.fif contracts/${contractName}.fc 2>&1 1>node_modules/.tmpfunc`).toString();
        if (buildErrors.length > 0) {
            console.log(` - OH NO! Compilation Errors! The compiler output was:`);
            console.log(`\n${buildErrors}`);
            process.exit(1);
        } else {
            console.log(` - Compilation successful!`);
        }

        // make sure fif build artifact was created
        if (!fs.existsSync(fiftArtifact)) {
            console.log(` - For some reason '${fiftArtifact}' was not created!`);
            process.exit(1);
        } else {
            console.log(` - Build artifact created '${fiftArtifact}'`);
        }

        // create a temp cell.fif that will generate the cell
        let fiftCellSource = `"Asm.fif" include\n`;
        fiftCellSource += `${fs.readFileSync(fiftArtifact).toString()}\n`;
        fiftCellSource += `boc>B "${cellArtifact}" B>file`;
        fs.writeFileSync(fiftCellArtifact, fiftCellSource);

        // run fift cli to create the cell
        try {
            child_process.execSync(`fift ${fiftCellArtifact}`);
        } catch (e) {
            console.log(`FATAL ERROR: 'fift' executable failed, is FIFTPATH env variable defined?`);
            process.exit(1);
        }

        // make sure cell build artifact was created
        if (!fs.existsSync(cellArtifact)) {
            console.log(` - For some reason '${cellArtifact}' was not created!`);
            process.exit(1);
        } else {
            console.log(` - Build artifact created '${cellArtifact}'`);
            fs.unlinkSync(fiftCellArtifact);
        }
    }

    console.log(``);
}

main();