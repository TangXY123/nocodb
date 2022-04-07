const fs = require('fs')
const path = require('path');
const { mainModule } = require('process');

const execSync = require('child_process').execSync;

// extract latest version from package.json
const nocodbSdkPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packages', 'nocodb-sdk', 'package.json'), 'utf8'))

const replacePackageName = (filePath) => {
    return new Promise((resolve, reject) => {
        return fs.readFile(filePath, 'utf8', function (err, data) {
            if (err) return reject(err)
            var result = data.replace(/nocodb-sdk/g, nocodbSdkPackage.name);
            return fs.writeFile(filePath, result, 'utf8', function (err) {
                if (err) return reject(err)
                return resolve()
            });
        });
    })
}

const bumbVersionAndSave = () => {
    // upgrade nocodb-sdk version in nocodb
    execSync(`cd packages/nocodb && npm install --save --save-exact ${nocodbSdkPackage.name}@${nocodbSdkPackage.version}`, {});
    // upgrade nocodb-sdk version in nc-gui
    execSync(`cd packages/nc-gui && npm install --save --save-exact ${nocodbSdkPackage.name}@${nocodbSdkPackage.version}`, {});
}

const dfs = function(dir) {
    var res = [];
    var list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = dir + '/' + file;
        var stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            res = res.concat(dfs(file));
        } else {
            const ext = path.extname(file).toLowerCase()
            if (ext == '.vue' || ext == '.ts') {
                res.push(file);
            }
        }
    })
    return res;
}

const searchAndReplace = (target) => {
    const dirPath = path.resolve(path.join(__dirname, '..', 'packages'))
    let list = dfs(dirPath)
    list = [
        ...list,
        path.join(__dirname, '..', 'packages', 'nc-gui', 'package.json'),
        path.join(__dirname, '..', 'packages', 'nocodb', 'package.json')
    ]
    return Promise.all(list.map(d => {
        return new Promise((resolve, reject) => {
            fs.readFile(d, function(err, content) {
                if (err) reject(err)
                if (content.indexOf(target) > -1) {
                    replacePackageName(d)
                }
                resolve()
            })
        })
    }))
}

if (process.env.targetEnv === 'DEV') {
    // replace nocodb-sdk by nocodb-sdk-daily if it is nightly build
    searchAndReplace('nocodb-sdk')
    .then(() => {
        bumbVersionAndSave()
    })
} else {
    bumbVersionAndSave()
}
