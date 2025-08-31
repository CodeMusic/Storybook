import type { AppProps } from "next/app";
import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps)
{
  return (
    <>
      <Head>
        <meta name="theme-color" content="#f59e0b" />
        <meta property="og:site_name" content="Storyforge" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}


