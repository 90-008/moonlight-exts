import { ExtensionWebExports } from "@moonlight-mod/types";

// https://moonlight-mod.github.io/ext-dev/webpack/#patching
export const patches: ExtensionWebExports["patches"] = [];

// https://moonlight-mod.github.io/ext-dev/webpack/#webpack-module-insertion
export const webpackModules: ExtensionWebExports["webpackModules"] = {
  client: {
    dependencies: [
      { ext: "spacepack", id: "spacepack" },
      { id: "discord/Dispatcher" }
    ],
    entrypoint: true
  }
};
