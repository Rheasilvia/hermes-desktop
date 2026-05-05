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

  // Restricted imports -- forbid gateway and direct transport access
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/services/api/**"],
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
          patterns: [
            {
              group: ["@/services/gateway/*"],
              message: "Model/Cron stores must use @/services/api (D7).",
            },
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
