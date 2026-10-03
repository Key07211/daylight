import test from 'node:test';
import assert from 'node:assert/strict';
import { taskPayload } from '../src/task-data.js';

const task = {id:'existing',title:'Review',notes:'',projectId:null,priority:'low',dueAt:null,reminderAt:null,completed:false,createdAt:'2026-10-02T00:00:00Z',automation:{enabled:true,prompt:'Summarize',workspace:'C:\\work',runAt:'2026-10-02T15:00:00Z',repeat:'daily',sandbox:'read-only'}};
test('editing a note cannot overwrite a schedule advanced while the editor was open',()=>{
  assert.deepEqual(taskPayload(task,{...task,notes:'New note'}),{notes:'New note'});
});
test('pausing a schedule only changes enabled and preserves the current next run',()=>{
  assert.deepEqual(taskPayload(task,{...task,automation:{...task.automation,enabled:false}}),{automation:{enabled:false}});
});
test('new task payload excludes server-owned metadata and trims title',()=>{
  const result=taskPayload({}, {...task,title:' Review '});
  assert.equal(result.title,'Review');
  assert.equal(result.id,undefined);
  assert.equal(result.createdAt,undefined);
  assert.deepEqual(result.automation,task.automation);
});
test('scheduling a manual task submits both the selected time and the enabled state',()=>{
  const manual={...task,automation:{...task.automation,enabled:false,runAt:null}};
  assert.deepEqual(taskPayload(manual,task),{automation:{enabled:true,runAt:task.automation.runAt}});
});
