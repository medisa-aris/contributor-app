export type MindMapMode = 'second_brain' | 'counterpart' | 'subordinate';

export interface MindMapQuery {
  days: number;
  modes: MindMapMode[];
}

export interface MindMapDepartment {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
}

export interface MindMapPerson {
  id: string;
  displayName: string;
  jobTitle: string | null;
  departmentId: string | null;
  counts: Record<MindMapMode, number>;
  total: number;
  lastAt: string | null;
}

export interface MindMapOrg {
  departments: MindMapDepartment[];
  people: MindMapPerson[];
}

export interface MindMapThought {
  id: string;
  mode: MindMapMode;
  title: string;
  status: string | null;
  at: string;
}

export interface MindMapPersonThoughts {
  person: {
    id: string;
    displayName: string;
    jobTitle: string | null;
    departmentName: string | null;
  };
  thoughts: MindMapThought[];
}

export interface MindMapTopicPerson {
  id: string;
  displayName: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  count: number;
  thoughts: MindMapThought[];
}

export interface MindMapTopics {
  query: string;
  total: number;
  people: MindMapTopicPerson[];
  keywords: { word: string; count: number }[];
}
