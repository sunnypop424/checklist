/**
 * 'manual' = 사람이 /control 에서 만든 목록
 * 'pal'    = 팰월드 트래커가 sync 로 채우는 목록. /control 에서는 읽기 전용이다.
 */
export type ListSource = 'manual' | 'pal';

export type List = {
  id: string;
  title: string;
  sort: number;
  source: ListSource;
  created_at: string;
  updated_at: string;
};

export type Item = {
  id: string;
  list_id: string;
  label: string;
  done: boolean;
  position: number;
  /** 트래커가 생성한 항목의 안정적 식별자 ('farm:hunt_fire'). 수동 항목은 null. */
  ref: string | null;
  created_at: string;
};

/** 트래커가 관리하는 목록인가 (구 데이터에 source 가 없을 수 있어 방어적으로 비교) */
export function isPalList(list: Pick<List, 'source'> | null | undefined): boolean {
  return list?.source === 'pal';
}

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
