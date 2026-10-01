import { defineConfig } from "@playwright/test";

const deployedURL = process.env.ME_TEST_BASE_URL;
export default defineConfig({
  testDir: "tests/deployment",
  timeout: 120000,
  use: {
    baseURL: deployedURL || "http://127.0.0.1:4175/M.E./",
    headless: true,
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
    },
  },
  webServer: deployedURL
    ? undefined
    : {
        command: "npm run preview -- --base /M.E./ --port 4175 --strictPort",
        url: "http://127.0.0.1:4175/M.E./",
        timeout: 30000,
        reuseExistingServer: false,
      },
});
