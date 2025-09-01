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
        {/* Fallback OG/Twitter image */}
        <meta property="og:image" content="https://story.codemusic.ca/Storyforge.png" />
        <meta property="og:image:secure_url" content="https://story.codemusic.ca/Storyforge.png" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Storyforge cover" />
        <meta name="twitter:image" content="https://story.codemusic.ca/Storyforge.png" />
        <meta name="twitter:image:alt" content="Storyforge cover" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}


