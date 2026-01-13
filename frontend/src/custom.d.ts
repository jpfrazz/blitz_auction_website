declare namespace JSX {
  interface IntrinsicElements {
    'sl-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    // Add more Shoelace elements as needed
  }
}

declare module '*.scss' {
  const content: { [className: string]: string };
  export default content;
}