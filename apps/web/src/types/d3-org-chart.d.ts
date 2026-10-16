import 'd3-org-chart';
import type { HierarchyNode } from 'd3-hierarchy';

declare module 'd3-org-chart' {
  interface OrgChart<Datum> {
    container(value: string | HTMLElement): this;
    data(): Datum[] | null;
    data(value: Datum[] | null): this;
    nodeWidth(value: (node: HierarchyNode<Datum>) => number): this;
    nodeHeight(value: (node: HierarchyNode<Datum>) => number): this;
    childrenMargin(value: (node: HierarchyNode<Datum>) => number): this;
    initialExpandLevel(value: number): this;
    compact(value: boolean): this;
    layout(value: 'top' | 'left' | 'right' | 'bottom'): this;
    nodeContent(value: (node: HierarchyNode<Datum>) => string): this;
    buttonContent(value: (params: { node: HierarchyNode<Datum> }) => string): this;
    onNodeClick(value: (node: HierarchyNode<Datum>) => void): this;
  }
}
