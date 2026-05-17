import type { Component } from 'solid-js';
import { Switch, Match } from 'solid-js';
import type { AttachmentBlock } from '@/types/index.js';
import { ImageCard } from './ImageCard.js';
import { FileAttachmentCard } from './FileAttachmentCard.js';

interface AttachmentRendererProps {
  block: AttachmentBlock;
}

export const AttachmentRenderer: Component<AttachmentRendererProps> = (props) => {
  const attachment = () => props.block.attachment;

  return (
    <Switch>
      <Match when={attachment().type === 'image'}>
        <ImageCard url={attachment().localPath} altText={attachment().name} />
      </Match>
      <Match when={attachment().type === 'file'}>
        <FileAttachmentCard
          name={attachment().name}
          size={attachment().size}
          mimeType={attachment().mimeType}
          preview={attachment().preview}
        />
      </Match>
      <Match when={attachment().type === 'audio' || attachment().type === 'video'}>
        <FileAttachmentCard
          name={attachment().name}
          size={attachment().size}
          mimeType={attachment().mimeType}
        />
      </Match>
    </Switch>
  );
};
