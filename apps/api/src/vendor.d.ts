// selenium-webdriver ships these modules without type declarations.
declare module 'selenium-webdriver/http/index.js' {
  const http: { Executor: new (client: unknown) => any; HttpClient: new (url: string) => unknown };
  export default http;
}
