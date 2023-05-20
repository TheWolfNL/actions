"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs-extra"));
const YAML = __importStar(require("yaml"));
async function requestAddedModifiedFiles(baseCommit, headCommit, githubToken, requireHeadAheadOfBase) {
    const result = [];
    const octokit = github.getOctokit(githubToken);
    core.info(`Base commit: ${baseCommit}`);
    core.info(`Head commit: ${headCommit}`);
    // Use GitHub's compare two commits API.
    const response = await octokit.rest.repos.compareCommits({
        base: baseCommit,
        head: headCommit,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    });
    // Ensure that the request was successful.
    if (response.status !== 200) {
        throw new Error(`The GitHub API returned ${response.status}, expected 200.`);
    }
    // Ensure that the head commit is ahead of the base commit.
    if (requireHeadAheadOfBase && response.data.status !== "ahead") {
        throw new Error(`The head commit for this ${github.context.eventName} event is not ahead of the base commit.`);
    }
    const responseFiles = response.data.files || [];
    for (const file of responseFiles) {
        const filestatus = file.status;
        if (filestatus === "added" || filestatus === "modified") {
            result.push(file.filename);
        }
    }
    return result;
}
async function requestAllFiles(commit, githubToken) {
    const result = [];
    const octokit = github.getOctokit(githubToken);
    core.info(`Commit SHA: ${commit}`);
    const response = await octokit.rest.git.getTree({
        tree_sha: commit,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        recursive: "true",
    });
    // Ensure that the request was successful.
    if (response.status !== 200) {
        throw new Error(`The GitHub API returned ${response.status}, expected 200.`);
    }
    const responseTreeItems = response.data.tree || [];
    for (const item of responseTreeItems) {
        if (item.type === "blob" && item.path) {
            result.push(item.path);
        }
    }
    return result;
}
async function getConfig(configPath) {
    var _a;
    // Ensure that the repo config file exists.
    if (!(await fs.pathExists(configPath))) {
        throw new Error(`${configPath} Does not exist!`);
    }
    const configRaw = await fs.readFile(configPath, "utf8");
    const yamlConfig = await YAML.parse(configRaw);
    let config;
    if (yamlConfig) {
        config = {
            excluded_directories: (_a = yamlConfig["excluded-directories"]) !== null && _a !== void 0 ? _a : [],
        };
    }
    else {
        config = {
            excluded_directories: [],
        };
    }
    return config;
}
function filterChangedDirectories(files, parentFolder) {
    const filteredChartFiles = files.filter((file) => {
        const rel = path.relative(parentFolder, file);
        return !rel.startsWith("../") && rel !== "..";
    });
    const changedCharts = [];
    for (const file of filteredChartFiles) {
        const absoluteParentFolder = path.resolve(parentFolder);
        const absoluteFileDirname = path.resolve(path.dirname(file));
        const relativeFileDirname = absoluteFileDirname.slice(absoluteParentFolder.length + 1);
        changedCharts.push(`${relativeFileDirname}`);
    }
    // Return only unique items
    var result = changedCharts.filter((item, index) => changedCharts.indexOf(item) === index);
    return result;
}
async function run() {
    var _a, _b, _c, _d;
    try {
        const githubToken = core.getInput("token", { required: true });
        const baseFolder = core.getInput("baseFolder", { required: true });
        const requireHeadAheadOfBase = core.getInput("requireHeadAheadOfBase", {
            required: false,
        });
        const configFilePath = core.getInput("configFile", {
            required: true,
        });
        let getAllDirectories = core.getInput("getAllDirectories", { required: false });
        const overrideDirectories = core.getInput("overrideDirectories", { required: false });
        const config = await getConfig(configFilePath);
        core.info(`Configuration: ${JSON.stringify(config, undefined, 2)}`);
        let responseDirectories;
        if (overrideDirectories && overrideDirectories !== "[]") {
            responseDirectories = YAML.parse(overrideDirectories);
        }
        else {
            const eventName = github.context.eventName;
            let baseCommit;
            let headCommit;
            switch (eventName) {
                case "pull_request":
                    baseCommit = (_b = (_a = github.context.payload.pull_request) === null || _a === void 0 ? void 0 : _a.base) === null || _b === void 0 ? void 0 : _b.sha;
                    headCommit = (_d = (_c = github.context.payload.pull_request) === null || _c === void 0 ? void 0 : _c.head) === null || _d === void 0 ? void 0 : _d.sha;
                    break;
                case "push":
                    baseCommit = github.context.payload.before;
                    headCommit = github.context.payload.after;
                    break;
                case "workflow_dispatch":
                    getAllDirectories = "true";
                    baseCommit = "";
                    headCommit = github.context.sha;
                    break;
                default:
                    throw new Error(`This action only supports pull requests, pushes and workflow_dispatch,` +
                        `${github.context.eventName} events are not supported.`);
            }
            if (!headCommit) {
                throw new Error(`No HEAD commit was found to compare to.`);
            }
            let responseFiles;
            if (getAllDirectories === "true") {
                responseFiles = await requestAllFiles(headCommit, githubToken);
            }
            else {
                responseFiles = await requestAddedModifiedFiles(baseCommit, headCommit, githubToken, requireHeadAheadOfBase === "true");
            }
            responseDirectories = filterChangedDirectories(responseFiles, baseFolder);
        }
        // Determine changed directories
        // core.info(`Directories: ${JSON.stringify(responseDirectories, undefined, 2)}`);
        // core.setOutput("directories", responseDirectories);
        // Determine charts to install
        const directories = responseDirectories.filter((x) => !config.excluded_directories.includes(x));
        core.info(`Directories: ${JSON.stringify(directories, undefined, 2)}`);
        core.setOutput("directories", directories);
    }
    catch (error) {
        core.setFailed(String(error));
    }
}
async function runWrapper() {
    try {
        await run();
    }
    catch (error) {
        core.setFailed(`split-changes-into-dirs action failed: ${error}`);
        console.log(error);
    }
}
void runWrapper();
//# sourceMappingURL=split-changes-into-dirs.js.map