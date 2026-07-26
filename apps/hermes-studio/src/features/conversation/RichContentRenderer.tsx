import type { Component } from 'solid-js';
import { Switch, Match } from 'solid-js';
import type { RichContentBlock, ChartData, WebSearchResult, ImageContent, ImageTextContent, FileContent } from '@/types/index.js';
import { ChartCard } from './ChartCard.js';
import { WebSearchCard } from './WebSearchCard.js';
import { ImageCard } from './ImageCard.js';
import { ImageTextCard } from './ImageTextCard.js';
import { FileAttachmentCard } from './FileAttachmentCard.js';

interface RichContentRendererProps {
  block: RichContentBlock;
}

export const RichContentRenderer: Component<RichContentRendererProps> = (props) => {
  return (
    <Switch>
      <Match when={props.block.kind === 'chart'}>
        <ChartCard data={props.block.data as ChartData} />
      </Match>
      <Match when={props.block.kind === 'web_search'}>
        <WebSearchCard data={props.block.data as WebSearchResult} />
      </Match>
      <Match when={props.block.kind === 'image'}>
        {(() => {
          const img = props.block.data as ImageContent;
          return <ImageCard url={img.url} altText={img.altText} caption={img.caption} />;
        })()}
      </Match>
      <Match when={props.block.kind === 'image_text'}>
        {(() => {
          const d = props.block.data as ImageTextContent;
          return <ImageTextCard url={d.url} altText={d.altText} title={d.title} body={d.body} tags={d.tags} />;
        })()}
      </Match>
      <Match when={props.block.kind === 'file'}>
        {(() => {
          const file = props.block.data as FileContent;
          return (
            <FileAttachmentCard
              name={file.name}
              size={file.size}
              mimeType={file.mimeType}
              preview={file.preview}
              onDownload={() => {}}
            />
          );
        })()}
      </Match>
    </Switch>
  );
};
