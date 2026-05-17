import type { Component } from 'solid-js';
import { Switch, Match } from 'solid-js';
import type { RichContentBlock, ChartData, WebSearchResult, ImageContent, FileContent } from '@/types/index.js';
import { ChartCard } from './ChartCard.js';
import { WebSearchCard } from './WebSearchCard.js';
import { ImageCard } from './ImageCard.js';
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
          return <ImageCard url={img.url} altText={img.altText} />;
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
            />
          );
        })()}
      </Match>
    </Switch>
  );
};
