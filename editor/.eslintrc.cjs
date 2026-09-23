// `npm run lint --workspace editor`. Type errors are `typecheck`'s job; this is
// for what the compiler does not see -- above all the rules of hooks, whose
// breaking shows up as a panel that forgets what was typed into it.
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  // No react-refresh rule: files here keep a component beside the functions it
  // is drawn from, on purpose, and the price is a full reload in `npm run dev`.
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  },
};
