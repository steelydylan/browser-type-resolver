import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { resolveAllModuleType } from "./type-resolver";
import JsonView from '@uiw/react-json-view';
import { lightTheme } from '@uiw/react-json-view/light';

const deps = {
  "react": "18.2.0",
  "react-dom": "18.2.0",
  "react-hook-form": "7.45.4",
  "@hookform/resolvers": "3.3.0",
  "zod": "3.22.2"
}

function App() {
  const [dependencies, setDependencies] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    resolveAllModuleType(deps).then((result) => {
      setDependencies(result);
    })
  }, []);

  return (<div>
    <pre>
      <code>{JSON.stringify(deps, null, 2)}</code>
    </pre>
    <JsonView value={dependencies} style={lightTheme} />
    <style>
      {`
        .w-rjv-value {
          width: 200px;
          white-space: nowrap;
          display: inline-block;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}
    </style>
  </div>)
}


ReactDOM.render(<App />, document.getElementById("app"));
