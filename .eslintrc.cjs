module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  },
  ignorePatterns: ["node_modules/"],
};
