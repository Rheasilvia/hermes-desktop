import type { Component } from 'solid-js';
import { createEffect } from 'solid-js';
import {
  MessageSquare,
  ClipboardList,
  Settings,
  Bot,
  Wrench,
  Plug,
  Brain,
  Radio,
  Clock,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  Paperclip,
  Send,
  MoreHorizontal,
  Copy,
  RefreshCw,
  X,
  Search,
  Check,
  AlertCircle,
  Info,
  Sparkles,
  Zap,
  User,
  LogOut,
  CornerDownLeft,
  FileText,
  GitBranch,
  Store,
  Package,
  CheckCircle,
  Shuffle,
  Mail,
  Book,
  Bug,
  FlaskConical,
  FolderOpen,
  Smartphone,
  MessageCircle,
  Lock,
  Home,
  Terminal,
  AlertTriangle,
  Cpu,
  FileCheck,
  Globe,
  Monitor,
  Palette,
  Handshake,
  Layers,
  Code,
  RadioTower,
  Disc,
  Save,
  Leaf,
  Eye,
  EyeOff,
  Image,
  Download,
  ExternalLink,
  File,
  FileCode,
  ArrowUp,
  GitPullRequest,
  Lightbulb,
  Loader,
  ThumbsUp,
  ThumbsDown,
  Pencil,
  Trash2,
  Ellipsis,
} from 'lucide-solid';

export type IconName =
  | 'message-square'
  | 'clipboard-list'
  | 'settings'
  | 'bot'
  | 'wrench'
  | 'plug'
  | 'brain'
  | 'radio'
  | 'clock'
  | 'plus'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevrons-up-down'
  | 'paperclip'
  | 'send'
  | 'more-horizontal'
  | 'copy'
  | 'refresh-cw'
  | 'x'
  | 'search'
  | 'check'
  | 'alert-circle'
  | 'info'
  | 'sparkles'
  | 'zap'
  | 'user'
  | 'log-out'
  | 'corner-down-left'
  | 'file-text'
  | 'git-branch'
  | 'store'
  | 'package'
  | 'check-circle'
  | 'shuffle'
  | 'mail'
  | 'book'
  | 'bug'
  | 'flask-conical'
  | 'folder-open'
  | 'smartphone'
  | 'message-circle'
  | 'lock'
  | 'home'
  | 'terminal'
  | 'alert-triangle'
  | 'cpu'
  | 'file-check'
  | 'globe'
  | 'monitor'
  | 'palette'
  | 'handshake'
  | 'layers'
  | 'code'
  | 'radio-tower'
  | 'disc'
  | 'save'
  | 'leaf'
  | 'eye'
  | 'eye-off'
  | 'image'
  | 'download'
  | 'external-link'
  | 'file'
  | 'file-code'
  | 'arrow-up'
  | 'git-pull-request'
  | 'lightbulb'
  | 'loader'
  | 'thumbs-up'
  | 'thumbs-down'
  | 'pencil'
  | 'trash-2'
  | 'ellipsis';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  class?: string;
}

const LUCIDE_ICONS: Record<IconName, Component<{ size?: number; strokeWidth?: number; class?: string }>> = {
  'message-square': MessageSquare,
  'clipboard-list': ClipboardList,
  'settings': Settings,
  'bot': Bot,
  'wrench': Wrench,
  'plug': Plug,
  'brain': Brain,
  'radio': Radio,
  'clock': Clock,
  'plus': Plus,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevrons-up-down': ChevronsUpDown,
  'paperclip': Paperclip,
  'send': Send,
  'more-horizontal': MoreHorizontal,
  'copy': Copy,
  'refresh-cw': RefreshCw,
  'x': X,
  'search': Search,
  'check': Check,
  'alert-circle': AlertCircle,
  'info': Info,
  'sparkles': Sparkles,
  'zap': Zap,
  'user': User,
  'log-out': LogOut,
  'corner-down-left': CornerDownLeft,
  'file-text': FileText,
  'git-branch': GitBranch,
  'store': Store,
  'package': Package,
  'check-circle': CheckCircle,
  'shuffle': Shuffle,
  'mail': Mail,
  'book': Book,
  'bug': Bug,
  'flask-conical': FlaskConical,
  'folder-open': FolderOpen,
  'smartphone': Smartphone,
  'message-circle': MessageCircle,
  'lock': Lock,
  'home': Home,
  'terminal': Terminal,
  'alert-triangle': AlertTriangle,
  'cpu': Cpu,
  'file-check': FileCheck,
  'globe': Globe,
  'monitor': Monitor,
  'palette': Palette,
  'handshake': Handshake,
  'layers': Layers,
  'code': Code,
  'radio-tower': RadioTower,
  'disc': Disc,
  'save': Save,
  'leaf': Leaf,
  'eye': Eye,
  'eye-off': EyeOff,
  'image': Image,
  'download': Download,
  'external-link': ExternalLink,
  'file': File,
  'file-code': FileCode,
  'arrow-up': ArrowUp,
  'git-pull-request': GitPullRequest,
  'lightbulb': Lightbulb,
  'loader': Loader,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'pencil': Pencil,
  'trash-2': Trash2,
  'ellipsis': Ellipsis,
};

export const Icon: Component<IconProps> = (props) => {
  const LucideIcon = LUCIDE_ICONS[props.name];
  if (LucideIcon) {
    return (
      <LucideIcon
        size={props.size ?? 16}
        strokeWidth={props.strokeWidth ?? 1.5}
        class={props.class}
      />
    );
  }
  return null;
};
