/**
 * Nested document / array operation types.
 *
 * These map to MongoDB update operators and allow surgical mutation of nested
 * objects and arrays without replacing the entire field.
 */

/**
 * set      - Set a value at a dot-path.                      $set
 * unset    - Remove a field at a dot-path.                   $unset
 * push     - Append one item to an array.                    $push
 * push_many- Append multiple items to an array.              $push + $each
 * pull     - Remove items from an array matching a filter.   $pull
 * pull_id  - Remove the array item whose _mmid matches.      $pull
 * patch_item - Update fields on an array item by _mmid.      $set + arrayFilters
 * add_to_set - Push only if the value is not already present.$addToSet
 * increment  - Add (or subtract) a number to a field.        $inc
 * rename     - Rename a field.                               $rename
 */
export type NestedOperation =
  | "set"
  | "unset"
  | "push"
  | "push_many"
  | "pull"
  | "pull_id"
  | "patch_item"
  | "add_to_set"
  | "increment"
  | "rename";

export interface NestedOpPayload {
  /** Dot-path to the target field, e.g. "services" or "personal_information.email" */
  field: string;

  /** The operation to perform */
  operation: NestedOperation;

  /**
   * The value to use.
   *
   * set          -> any value
   * unset        -> omit or pass null
   * push         -> the single item to append
   * push_many    -> array of items to append
   * pull         -> a filter object, e.g. { name: "Ironing Service" }
   * pull_id      -> the _mmid string of the item to remove
   * patch_item   -> { _mmid: string, ...fieldsToUpdate }
   * add_to_set   -> the single value to conditionally add
   * increment    -> a number (positive or negative)
   * rename       -> the new field name string
   */
  value?: unknown;
}

export interface NestedOpResult<T = unknown> {
  updated: T | null;
}
