/**
 * Rich content data shapes — used as RichContentBlock.data.
 */

export interface ChartDataset {
  label: string;
  values: number[];
  color?: string;
}

export interface ChartData {
  chartType: 'bar' | 'line' | 'pie';
  labels: string[];
  datasets: ChartDataset[];
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchResultItem[];
}

export interface ImageContent {
  url: string;
  altText: string | null;
  caption?: string;
  width?: number;
  height?: number;
}

export interface ImageTextContent {
  url: string;
  altText: string | null;
  title: string;
  body: string;
  tags?: string[];
}

export interface FileContent {
  name: string;
  size: number;
  mimeType: string;
  preview: string | null;
}
