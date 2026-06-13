import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist"] },

  // Base TypeScript config
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
    },
  },

  // Restricted imports -- keep management surfaces on the API registry while
  // allowing the app bootstrap and conversation/live path to own the gateway.
  {
    files: [
      "src/stores/{analytics,config,cron,desktop-settings,memory,models,settings,usage}.{ts,tsx}",
      "src/features/{analytics,cron,memory,model,plugins,settings,skills}/**/*.{ts,tsx}",
    ],
    ignores: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "src/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/services/gateway",
              message: "Model/Cron stores must use @/services/api (D7).",
            },
          ],
          patterns: [{
            group: ["@/services/gateway/*"],
            message: "Model/Cron stores must use @/services/api (D7).",
          }],
        },
      ],
    },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/services/api/**",
      "src/**/*.{test,spec}.{ts,tsx}",
      "src/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/services/api/transports/*",
                "@/services/api/http-client",
              ],
              message:
                "Use the api registry (@/services/api), not transports directly.",
            },
          ],
        },
      ],
    },
  },
];
