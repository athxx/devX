export type NoteItem = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type NoteState = {
  notes: NoteItem[];
};
