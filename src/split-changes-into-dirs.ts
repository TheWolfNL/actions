import * as path from "path";

import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs-extra";
import * as YAML from "yaml";

type FileStatus = "added" | "modified" | "removed" | "renamed";

interface config {
  excluded_directories: string[];
}

async function requestAddedModifiedFiles(
  baseCommit: string,
  headCommit: string,
  githubToken: string,
  requireHeadAheadOfBase: boolean
) {
  const result: string[] = [];
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
    throw new Error(
      `The GitHub API returned ${response.status}, expected 200.`
    );
  }

  // Ensure that the head commit is ahead of the base commit.
  if (requireHeadAheadOfBase && response.data.status !== "ahead") {
    throw new Error(
      `The head commit for this ${github.context.eventName} event is not ahead of the base commit.`
    );
  }

  const responseFiles = response.data.files || [];
  for (const file of responseFiles) {
    const filestatus = file.status as FileStatus;
    if (filestatus === "added" || filestatus === "modified") {
      result.push(file.filename);
    }
  }
  return result;
}

async function requestAllFiles(commit: string, githubToken: string) {
  const result: string[] = [];
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
    throw new Error(
      `The GitHub API returned ${response.status}, expected 200.`
    );
  }

  const responseTreeItems = response.data.tree || [];
  for (const item of responseTreeItems) {
    if (item.type === "blob" && item.path) {
      result.push(item.path);
    }
  }
  return result;
}

async function getConfig(configPath: string) {
  // Ensure that the repo config file exists.
  if (!(await fs.pathExists(configPath))) {
    throw new Error(`${configPath} Does not exist!`);
  }

  const configRaw = await fs.readFile(configPath, "utf8");
  const yamlConfig = await YAML.parse(configRaw);

  let config: config;
  if (yamlConfig) {
    config = {
      excluded_directories: yamlConfig["excluded-directories"] ?? [],
    };
  } else {
    config = {
      excluded_directories: [],
    };
  }

  return config;
}

function filterChangedDirectories(files: string[], parentFolder: string) {
  const filteredChartFiles = files.filter((file) => {
    const rel = path.relative(parentFolder, file);
    return !rel.startsWith("../") && rel !== "..";
  });

  const changedCharts: string[] = [];
  for (const file of filteredChartFiles) {
    const absoluteParentFolder = path.resolve(parentFolder);
    const absoluteFileDirname = path.resolve(path.dirname(file));
    const relativeFileDirname = absoluteFileDirname.slice(
      absoluteParentFolder.length + 1
    );
    changedCharts.push(`${relativeFileDirname}`);
  }

  // Return only unique items
  var result = changedCharts.filter(
    (item, index) => changedCharts.indexOf(item) === index
  );
  return result;
}

async function run() {
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
    core.info(
      `Configuration: ${JSON.stringify(config, undefined, 2)}`
    );

    let responseDirectories: any;

    if (overrideDirectories && overrideDirectories !== "[]") {
      responseDirectories = YAML.parse(overrideDirectories);
    } else {
      const eventName = github.context.eventName;

      let baseCommit: string;
      let headCommit: string;

      switch (eventName) {
        case "pull_request":
          baseCommit = github.context.payload.pull_request?.base?.sha;
          headCommit = github.context.payload.pull_request?.head?.sha;
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
          throw new Error(
            `This action only supports pull requests, pushes and workflow_dispatch,` +
              `${github.context.eventName} events are not supported.`
          );
      }

      if (!headCommit) {
        throw new Error(`No HEAD commit was found to compare to.`);
      }

      let responseFiles: string[];
      if (getAllDirectories === "true") {
        responseFiles = await requestAllFiles(headCommit, githubToken);
      } else {
        responseFiles = await requestAddedModifiedFiles(
          baseCommit,
          headCommit,
          githubToken,
          requireHeadAheadOfBase === "true"
        );
      }
      responseDirectories = filterChangedDirectories(responseFiles, baseFolder);
    }

    // Determine changed directories
    // core.info(`Directories: ${JSON.stringify(responseDirectories, undefined, 2)}`);
    // core.setOutput("directories", responseDirectories);

    // Determine charts to install
    const directories = responseDirectories.filter(
      (x: string) => !config.excluded_directories.includes(x)
    );
    core.info(
      `Directories: ${JSON.stringify(directories, undefined, 2)}`
    );
    core.setOutput("directories", directories);
  } catch (error) {
    core.setFailed(String(error));
  }
}

async function runWrapper() {
  try {
    await run();
  } catch (error) {
    core.setFailed(`split-changes-into-dirs action failed: ${error}`);
    console.log(error);
  }
}

void runWrapper();