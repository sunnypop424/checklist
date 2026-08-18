export type List = {
  id: string;
  title: string;
  sort: number;
  created_at: string;
  updated_at: string;
};

export type Item = {
  id: string;
  list_id: string;
  label: string;
  done: boolean;
  position: number;
  created_at: string;
};

export type ListWithItems = {
  list: List;
  items: Item[];
};

export type MutateAction =
  | { action: 'create_list'; title?: string }
  | { action: 'rename_list'; listId: string; title: string }
  | { action: 'delete_list'; listId: string }
  | { action: 'reset_list'; listId: string }
  | { action: 'add_item'; listId: string; label: string }
  | { action: 'update_item'; itemId: string; label?: string; done?: boolean }
  | { action: 'delete_item'; itemId: string }
  | { action: 'reorder_items'; listId: string; ids: string[] };
