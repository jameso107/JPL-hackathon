/// <reference types="vite/client" />

declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
declare module '*.csv?raw' {
  const content: string;
  export default content;
}
declare module '*.json?raw' {
  const content: string;
  export default content;
}
