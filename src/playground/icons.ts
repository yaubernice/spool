import {
  Binary,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  createElement,
  createIcons,
  Download,
  FileCode,
  Files,
  Folder,
  Gamepad2,
  Keyboard,
  Maximize,
  Moon,
  PanelBottom,
  PanelLeft,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shapes,
  SkipForward,
  Sparkles,
  Square,
  Sun,
  Volume2,
  VolumeX,
  X,
} from 'lucide'

const set = {
  Binary,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  Download,
  FileCode,
  Files,
  Folder,
  Gamepad2,
  Keyboard,
  Maximize,
  Moon,
  PanelBottom,
  PanelLeft,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shapes,
  SkipForward,
  Sparkles,
  Square,
  Sun,
  Volume2,
  VolumeX,
  X,
}

/** Replace `data-lucide` placeholders inside `root`. */
export function mountIcons(root: ParentNode): void {
  createIcons({ icons: set, root: root as HTMLElement })
}

/** One SVG element, for rows built in script. */
export function iconEl(name: keyof typeof set): SVGElement {
  return createElement(set[name])
}
