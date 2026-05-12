export interface LoginResponse {
  token: string;
  refreshToken: string;
}

export interface EntityId {
  id: string;
  entityType: string;
}

export interface AssetInfo {
  id: EntityId;
  createdTime: number;
  tenantId: EntityId;
  customerId: EntityId;
  name: string;
  type: string;
  label: string;
  additionalInfo: any;
  customerTitle: string;
  assetProfileId: EntityId;
}

export interface Asset {
  id: EntityId;
  createdTime: number;
  tenantId: EntityId;
  customerId: EntityId;
  name: string;
  type: string;
  label: string;
  additionalInfo: unknown;
  assetProfileId: EntityId;
}

export interface Customer {
  id: EntityId;
  title?: string;
  name?: string;
}

export interface PageData<T> {
  data: T[];
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
}

export interface Relation {
  from: EntityId;
  to: EntityId;
  type: string;
  typeGroup: string;
  additionalInfo: unknown;
}

export interface RelationQuery {
  fromId?: string;
  fromType?: string;
  relationType?: string;
  toId?: string;
  toType?: string;
}
