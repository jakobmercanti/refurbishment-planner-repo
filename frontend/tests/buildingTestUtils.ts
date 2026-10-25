import { activeFloor, duplicateFloor } from '../lib/buildingDocument';
import type { ProjectDocument } from '../lib/projectDocument';

/** Fixture convenience; production has only blank Add and row-level Duplicate. */
export const copyTopFloor=(project:ProjectDocument,includeAssets=true)=>duplicateFloor(project,activeFloor(project).id,includeAssets);
